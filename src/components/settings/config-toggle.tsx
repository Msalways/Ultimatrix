interface ConfigToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
}

export function ConfigToggle({ checked, onChange, label, description, disabled }: ConfigToggleProps) {
  return (
    <label className="flex flex-col gap-1 cursor-pointer">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-zinc-700 transition-colors ${
            checked ? 'bg-emerald-600' : 'bg-zinc-800'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transform transition-transform mt-0.5 ${
              checked ? 'translate-x-4 ml-0' : 'translate-x-0 ml-0.5'
            }`}
          />
        </button>
        {label && <span className="text-xs text-zinc-300">{label}</span>}
      </div>
      {description && <span className="text-[11px] text-zinc-500 ml-11">{description}</span>}
    </label>
  )
}
