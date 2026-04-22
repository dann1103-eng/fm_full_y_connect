export default function InboxIndexPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-fm-background text-center p-12">
      <div className="max-w-sm">
        <div className="w-16 h-16 mx-auto rounded-full bg-fm-primary/10 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-fm-primary" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-fm-on-surface">Selecciona una conversación</h2>
        <p className="text-sm text-fm-on-surface-variant mt-2">
          Elige una conversación de la lista o inicia una nueva con el botón
          <b> &quot;Nuevo mensaje&quot;</b>.
        </p>
      </div>
    </div>
  )
}
