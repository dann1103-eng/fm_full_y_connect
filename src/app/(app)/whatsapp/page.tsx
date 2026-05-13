export const dynamic = 'force-dynamic'

export default function WhatsappEmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-center p-8">
      <div className="max-w-sm">
        <div className="w-14 h-14 rounded-full bg-green-100 text-green-700 mx-auto flex items-center justify-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.46 1.32 4.97L2 22l5.25-1.38a9.95 9.95 0 0 0 4.79 1.22h.01c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.17-2.92-7.05A9.91 9.91 0 0 0 12.04 2z"/>
          </svg>
        </div>
        <h1 className="text-lg font-medium text-fm-on-surface mb-1">Bandeja de WhatsApp</h1>
        <p className="text-sm text-fm-on-surface-variant">
          Selecciona una conversación de la lista para verla. Cuando un cliente escriba al número de FM,
          aparecerá aquí en tiempo real.
        </p>
      </div>
    </div>
  )
}
