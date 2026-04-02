import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs))
}

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[#1C1E22] text-white hover:bg-[#2A2D33] active:bg-[#14161A] disabled:opacity-50 shadow-md shadow-black/10 hover:shadow-lg transition-all duration-200',
  secondary:
    'bg-white text-[#1C1E22] border border-[#E5E5E3] hover:bg-[#F7F7F5] active:bg-[#EEEEEC] disabled:opacity-50 shadow-sm hover:shadow-md transition-all duration-200',
  destructive:
    'bg-transparent text-red-600 hover:text-red-700 hover:bg-red-50 active:bg-red-100 disabled:opacity-50 transition-colors',
  ghost:
    'bg-transparent text-[#6B7280] hover:text-[#1C1E22] hover:bg-[#F7F7F5] active:bg-[#EEEEEC] disabled:opacity-50 transition-colors',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs font-medium rounded-md gap-1.5',
  md: 'px-4 py-2 text-sm font-medium rounded-lg gap-2',
  lg: 'px-5 py-2.5 text-sm font-medium rounded-lg gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, className, children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center transition-colors duration-150 cursor-pointer select-none whitespace-nowrap',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  )
})
