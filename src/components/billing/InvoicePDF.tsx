/* eslint-disable jsx-a11y/alt-text */
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type {
  ClientFiscalSnapshot,
  EmitterSnapshot,
  Invoice,
  InvoiceItem,
} from '@/types/db'
import { PAYMENT_METHOD_LABELS } from '@/types/db'

const TEAL = '#00675c'
const RED = '#b31b25'
const GRAY = '#595c5e'
const BORDER = '#dfe3e6'
const BG_SOFT = '#f5f7f9'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: GRAY, fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  logoBox: { width: 80, height: 80, backgroundColor: TEAL, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  logoText: { color: 'white', fontSize: 24, fontFamily: 'Helvetica-Bold' },
  headerRight: { alignItems: 'flex-end', maxWidth: 260 },
  emitterName: { fontSize: 11, color: TEAL, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  emitterLegal: { fontSize: 9, color: GRAY, marginBottom: 4 },
  emitterSmall: { fontSize: 8, color: GRAY, textAlign: 'right', lineHeight: 1.4 },
  invoiceTitle: { fontSize: 26, fontFamily: 'Helvetica-Bold', color: TEAL, marginTop: 8 },
  metaGrid: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER, paddingVertical: 10, marginBottom: 20 },
  metaCol: { flex: 1, paddingHorizontal: 6 },
  metaLabel: { fontSize: 7, color: GRAY, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  metaValue: { fontSize: 9, color: '#1e293b' },
  metaValueBold: { fontSize: 9, color: '#1e293b', fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  tableHeader: { flexDirection: 'row', backgroundColor: BG_SOFT, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 4 },
  tableHeaderCell: { fontSize: 8, color: GRAY, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'Helvetica-Bold' },
  tableRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: 0.5, borderColor: BORDER },
  colDesc: { flex: 3 },
  colQty: { width: 50, textAlign: 'right' },
  colPrice: { width: 80, textAlign: 'right' },
  colTotal: { width: 80, textAlign: 'right' },
  cellText: { fontSize: 9, color: '#1e293b' },
  cellBold: { fontSize: 9, color: '#1e293b', fontFamily: 'Helvetica-Bold' },
  totalsBox: { marginTop: 16, marginLeft: 'auto', width: 220 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsLabel: { fontSize: 9, color: GRAY },
  totalsValue: { fontSize: 9, color: '#1e293b', fontFamily: 'Helvetica-Bold' },
  totalsDivider: { height: 1, backgroundColor: BORDER, marginVertical: 4 },
  grandTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderColor: BORDER },
  grandTotalLabel: { fontSize: 10, color: '#1e293b', fontFamily: 'Helvetica-Bold' },
  grandTotalValue: { fontSize: 14, color: RED, fontFamily: 'Helvetica-Bold' },
  notesSection: { marginTop: 24, paddingTop: 12, borderTopWidth: 0.5, borderColor: BORDER },
  notesLabel: { fontSize: 7, color: GRAY, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  notesText: { fontSize: 9, color: '#1e293b', lineHeight: 1.5 },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, textAlign: 'center', fontSize: 7, color: GRAY, borderTopWidth: 0.5, borderColor: BORDER, paddingTop: 8 },
})

interface InvoicePDFProps {
  invoice: Invoice
  items: InvoiceItem[]
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export function InvoicePDF({ invoice, items }: InvoicePDFProps) {
  const emitter = invoice.emitter_snapshot_json as EmitterSnapshot
  const client = invoice.client_snapshot_json as ClientFiscalSnapshot
  const logoUrl = emitter.logo_url ?? null

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            {logoUrl ? (
              <Image src={logoUrl} style={{ width: 80, height: 80, objectFit: 'contain' }} />
            ) : (
              <View style={styles.logoBox}><Text style={styles.logoText}>FM</Text></View>
            )}
            <Text style={styles.invoiceTitle}>{invoice.invoice_number}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.emitterName}>{emitter.trade_name ?? emitter.legal_name}</Text>
            <Text style={styles.emitterLegal}>{emitter.legal_name}</Text>
            {emitter.fiscal_address && <Text style={styles.emitterSmall}>{emitter.fiscal_address}</Text>}
            <Text style={styles.emitterSmall}>El Salvador</Text>
            {emitter.nrc && <Text style={styles.emitterSmall}>Nº de Impuesto: {emitter.nrc}</Text>}
            {emitter.nit && <Text style={styles.emitterSmall}>NIT: {emitter.nit}</Text>}
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Facturado a</Text>
            <Text style={styles.metaValueBold}>{client.legal_name ?? client.name}</Text>
            {client.fiscal_address && <Text style={styles.metaValue}>{client.fiscal_address}</Text>}
            {client.nit && <Text style={styles.metaValue}>NIT: {client.nit}</Text>}
            {client.nrc && <Text style={styles.metaValue}>NRC: {client.nrc}</Text>}
            {client.contact_email && <Text style={styles.metaValue}>{client.contact_email}</Text>}
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Fecha de emisión</Text>
            <Text style={styles.metaValue}>{invoice.issue_date}</Text>
            {invoice.due_date && (
              <>
                <Text style={[styles.metaLabel, { marginTop: 6 }]}>Vencimiento</Text>
                <Text style={styles.metaValue}>{invoice.due_date}</Text>
              </>
            )}
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Método de pago</Text>
            <Text style={styles.metaValue}>{invoice.payment_method ? PAYMENT_METHOD_LABELS[invoice.payment_method] : '—'}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Referencia de pago</Text>
            <Text style={styles.metaValue}>{invoice.payment_reference ?? '—'}</Text>
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, styles.colDesc]}>Descripción</Text>
          <Text style={[styles.tableHeaderCell, styles.colQty]}>Cantidad</Text>
          <Text style={[styles.tableHeaderCell, styles.colPrice]}>Tarifa</Text>
          <Text style={[styles.tableHeaderCell, styles.colTotal]}>Total</Text>
        </View>
        {items.map(it => (
          <View key={it.id} style={styles.tableRow}>
            <Text style={[styles.cellText, styles.colDesc]}>{it.description}</Text>
            <Text style={[styles.cellText, styles.colQty]}>{Number(it.quantity)}</Text>
            <Text style={[styles.cellText, styles.colPrice]}>${formatMoney(Number(it.unit_price))}</Text>
            <Text style={[styles.cellBold, styles.colTotal]}>${formatMoney(Number(it.line_total))}</Text>
          </View>
        ))}

        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>${formatMoney(Number(invoice.subtotal))}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Descuento</Text>
            <Text style={styles.totalsValue}>-${formatMoney(Number(invoice.discount_amount))}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Impuesto ({(Number(invoice.tax_rate) * 100).toFixed(0)}%)</Text>
            <Text style={styles.totalsValue}>
              {Number(invoice.tax_rate) === 0 ? '-' : `$${formatMoney(Number(invoice.tax_amount))}`}
            </Text>
          </View>
          <View style={styles.totalsDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>Total (USD)</Text>
            <Text style={styles.grandTotalValue}>${formatMoney(Number(invoice.total))}</Text>
          </View>
        </View>

        {invoice.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesLabel}>Notas</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {emitter.invoice_footer_note && (
          <Text style={styles.footer}>{emitter.invoice_footer_note}</Text>
        )}
      </Page>
    </Document>
  )
}
