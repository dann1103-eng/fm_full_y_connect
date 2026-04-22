/* eslint-disable jsx-a11y/alt-text */
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type {
  ClientFiscalSnapshot,
  EmitterSnapshot,
  Quote,
  QuoteItem,
  PaymentMethodConfig,
  TermAndCondition,
} from '@/types/db'

const TEAL = '#00675c'
const RED = '#b31b25'
const GRAY = '#595c5e'
const BORDER = '#dfe3e6'
const BG_SOFT = '#f5f7f9'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: GRAY, fontFamily: 'Helvetica' },
  topBand: { backgroundColor: TEAL, marginHorizontal: -40, marginTop: -40, paddingHorizontal: 40, paddingVertical: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  brandGroup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBox: { width: 50, height: 50, backgroundColor: 'white', justifyContent: 'center', alignItems: 'center', borderRadius: 6 },
  logoText: { color: TEAL, fontSize: 18, fontFamily: 'Helvetica-Bold' },
  brandText: { color: 'white' },
  brandName: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  brandLegal: { fontSize: 8, opacity: 0.9 },
  emitterRight: { color: 'white', alignItems: 'flex-end', fontSize: 7 },
  quoteTitle: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: TEAL },
  datesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  dateBox: { fontSize: 8, color: GRAY },
  metaGrid: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  metaBox: { flex: 1, backgroundColor: BG_SOFT, padding: 12, borderRadius: 6 },
  metaLabel: { fontSize: 7, color: GRAY, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, fontFamily: 'Helvetica-Bold' },
  metaValue: { fontSize: 9, color: '#1e293b', marginBottom: 2 },
  metaValueBold: { fontSize: 10, color: '#1e293b', fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  tableHeader: { flexDirection: 'row', backgroundColor: TEAL, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 4 },
  tableHeaderCell: { fontSize: 8, color: 'white', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'Helvetica-Bold' },
  tableRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 0.5, borderColor: BORDER },
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
  section: { marginTop: 20, paddingTop: 12, borderTopWidth: 0.5, borderColor: BORDER },
  sectionTitle: { fontSize: 10, color: TEAL, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  pmBox: { backgroundColor: BG_SOFT, padding: 10, borderRadius: 6, marginBottom: 6 },
  pmLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1e293b', marginBottom: 3 },
  pmText: { fontSize: 8, color: GRAY, lineHeight: 1.4 },
  // T&C page
  tcHeader: { marginBottom: 20 },
  tcTitle: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: TEAL, marginBottom: 4 },
  tcSubtitle: { fontSize: 9, color: GRAY },
  tcItem: { flexDirection: 'row', marginBottom: 10, gap: 8 },
  tcNumber: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: RED, width: 22 },
  tcText: { fontSize: 9, color: '#1e293b', lineHeight: 1.5, flex: 1 },
  tcFooter: { position: 'absolute', bottom: 30, left: 40, right: 40, textAlign: 'center', fontSize: 7, color: GRAY, borderTopWidth: 0.5, borderColor: BORDER, paddingTop: 8 },
})

interface QuotePDFProps {
  quote: Quote
  items: QuoteItem[]
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export function QuotePDF({ quote, items }: QuotePDFProps) {
  const emitter = quote.emitter_snapshot_json as EmitterSnapshot
  const client = quote.client_snapshot_json as ClientFiscalSnapshot
  const terms = ((quote.terms_snapshot_json ?? []) as TermAndCondition[]).sort((a, b) => a.order - b.order)
  const paymentMethods = (emitter.payment_methods ?? []) as PaymentMethodConfig[]
  const logoUrl = emitter.logo_url ?? null

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.topBand}>
          <View style={styles.brandGroup}>
            {logoUrl ? (
              <Image src={logoUrl} style={{ width: 50, height: 50, objectFit: 'contain', backgroundColor: 'white', borderRadius: 6 }} />
            ) : (
              <View style={styles.logoBox}><Text style={styles.logoText}>FM</Text></View>
            )}
            <View style={styles.brandText}>
              <Text style={styles.brandName}>{emitter.trade_name ?? emitter.legal_name}</Text>
              <Text style={styles.brandLegal}>{emitter.legal_name}</Text>
            </View>
          </View>
          <View style={styles.emitterRight}>
            {emitter.nrc && <Text>NRC: {emitter.nrc}</Text>}
            {emitter.nit && <Text>NIT: {emitter.nit}</Text>}
            {emitter.phone && <Text>{emitter.phone}</Text>}
            {emitter.email && <Text>{emitter.email}</Text>}
          </View>
        </View>

        <View style={styles.datesRow}>
          <Text style={styles.quoteTitle}>Cotización {quote.quote_number}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.dateBox}>Fecha: {quote.issue_date}</Text>
            {quote.valid_until && <Text style={styles.dateBox}>Válida hasta: {quote.valid_until}</Text>}
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Cotizado a</Text>
            <Text style={styles.metaValueBold}>{client.legal_name ?? client.name}</Text>
            {client.fiscal_address && <Text style={styles.metaValue}>{client.fiscal_address}</Text>}
            {client.nit && <Text style={styles.metaValue}>NIT: {client.nit}</Text>}
            {client.nrc && <Text style={styles.metaValue}>NRC: {client.nrc}</Text>}
            {client.contact_email && <Text style={styles.metaValue}>{client.contact_email}</Text>}
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Datos del emisor</Text>
            <Text style={styles.metaValueBold}>{emitter.trade_name ?? emitter.legal_name}</Text>
            {emitter.fiscal_address && <Text style={styles.metaValue}>{emitter.fiscal_address}</Text>}
            {emitter.giro && <Text style={styles.metaValue}>Giro: {emitter.giro}</Text>}
            {emitter.phone && <Text style={styles.metaValue}>{emitter.phone}</Text>}
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, styles.colDesc]}>Descripción</Text>
          <Text style={[styles.tableHeaderCell, styles.colQty]}>Cantidad</Text>
          <Text style={[styles.tableHeaderCell, styles.colPrice]}>Precio unit.</Text>
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
            <Text style={styles.totalsValue}>${formatMoney(Number(quote.subtotal))}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Descuento</Text>
            <Text style={styles.totalsValue}>-${formatMoney(Number(quote.discount_amount))}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>IVA ({(Number(quote.tax_rate) * 100).toFixed(0)}%)</Text>
            <Text style={styles.totalsValue}>
              {Number(quote.tax_rate) === 0 ? '-' : `$${formatMoney(Number(quote.tax_amount))}`}
            </Text>
          </View>
          <View style={styles.totalsDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>Total (USD)</Text>
            <Text style={styles.grandTotalValue}>${formatMoney(Number(quote.total))}</Text>
          </View>
        </View>

        {paymentMethods.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Métodos de pago</Text>
            {paymentMethods.map(m => (
              <View key={m.id} style={styles.pmBox}>
                <Text style={styles.pmLabel}>{m.label}</Text>
                {m.type === 'bank' && (
                  <Text style={styles.pmText}>
                    {m.account_holder && `Titular: ${m.account_holder}\n`}
                    {m.account_number && `Cuenta: ${m.account_number}`}
                    {m.account_type && ` (${m.account_type})`}
                  </Text>
                )}
                {m.note && <Text style={styles.pmText}>{m.note}</Text>}
              </View>
            ))}
          </View>
        )}

        {quote.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notas</Text>
            <Text style={[styles.cellText, { lineHeight: 1.5 }]}>{quote.notes}</Text>
          </View>
        )}
      </Page>

      {terms.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <View style={styles.tcHeader}>
            <Text style={styles.tcTitle}>Términos y Condiciones</Text>
            <Text style={styles.tcSubtitle}>Cotización {quote.quote_number}</Text>
          </View>
          {terms.map((t, idx) => (
            <View key={t.id} style={styles.tcItem}>
              <Text style={styles.tcNumber}>{idx + 1}.</Text>
              <Text style={styles.tcText}>{t.text}</Text>
            </View>
          ))}
          <Text style={styles.tcFooter}>
            {emitter.trade_name ?? emitter.legal_name}
            {emitter.phone ? ` · ${emitter.phone}` : ''}
            {emitter.email ? ` · ${emitter.email}` : ''}
          </Text>
        </Page>
      )}
    </Document>
  )
}
