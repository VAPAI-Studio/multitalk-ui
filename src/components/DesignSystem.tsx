import React from 'react'

// Design tokens
export const tokens = {
  colors: {
    primary: {
      50: 'bg-emerald-50',
      100: 'bg-emerald-100', 
      500: 'bg-emerald-500',
      600: 'bg-emerald-600',
      700: 'bg-emerald-700',
      text: 'text-emerald-700',
      border: 'border-emerald-200'
    },
    secondary: {
      50: 'bg-blue-50',
      100: 'bg-blue-100',
      500: 'bg-blue-500',
      600: 'bg-blue-600',
      700: 'bg-blue-700',
      text: 'text-blue-700',
      border: 'border-blue-200'
    },
    accent: {
      50: 'bg-purple-50',
      100: 'bg-purple-100',
      500: 'bg-purple-500',
      600: 'bg-purple-600',
      700: 'bg-purple-700',
      text: 'text-purple-700',
      border: 'border-purple-200'
    },
    warning: {
      50: 'bg-amber-50',
      100: 'bg-amber-100',
      500: 'bg-amber-500',
      600: 'bg-amber-600',
      text: 'text-amber-700',
      border: 'border-amber-200'
    },
    gray: {
      50: 'bg-gray-50',
      100: 'bg-gray-100',
      200: 'bg-gray-200',
      300: 'bg-gray-300',
      text: {
        light: 'text-gray-500',
        medium: 'text-gray-600',
        dark: 'text-gray-900'
      },
      border: 'border-gray-200'
    },
    white: 'bg-white',
    danger: {
      50: 'bg-red-50',
      100: 'bg-red-100',
      600: 'bg-red-600',
      text: 'text-red-600',
      border: 'border-red-200'
    }
  },
  spacing: {
    xs: 'gap-1',
    sm: 'gap-2', 
    md: 'gap-3',
    lg: 'gap-4',
    xl: 'gap-6'
  },
  radius: {
    sm: 'rounded-md',
    md: 'rounded-lg',
    lg: 'rounded-xl',
    xl: 'rounded-2xl',
    full: 'rounded-full'
  },
  shadow: {
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-lg',
    xl: 'shadow-xl'
  }
}

// Enhanced Button component
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'accent' | 'warning' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}

export function Button({ 
  variant = 'secondary', 
  size = 'md', 
  children, 
  onClick, 
  disabled = false,
  className = ''
}: ButtonProps) {
  const baseClasses = 'font-medium transition-all duration-200 focus:ring-2 focus:ring-offset-1'
  
  const variants = {
    primary: 'bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-200 shadow-lg hover:shadow-xl',
    secondary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-200 shadow-lg hover:shadow-xl',
    accent: 'bg-purple-600 hover:bg-purple-700 text-white focus:ring-purple-200 shadow-lg hover:shadow-xl',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white focus:ring-amber-200 shadow-lg hover:shadow-xl',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-200 shadow-lg hover:shadow-xl',
    ghost: 'hover:bg-gray-100 text-gray-600 hover:shadow-md'
  }
  
  const sizes = {
    sm: 'px-2 py-1 text-xs rounded-md',
    md: 'px-3 py-1.5 text-sm rounded-md',
    lg: 'px-4 py-2 text-base rounded-md'
  }
  
  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : ''
  
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${disabledClasses} ${className}`}
    >
      {children}
    </button>
  )
}

// Enhanced Input component
interface InputProps {
  type?: 'text' | 'number' | 'file' | 'range'
  value?: string | number
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  min?: number
  max?: number
  step?: number
  className?: string
  disabled?: boolean
}

export function Input({ 
  type = 'text', 
  value, 
  onChange, 
  placeholder, 
  min, 
  max, 
  step,
  className = '',
  disabled = false
}: InputProps) {
  const baseClasses = 'transition-all duration-200 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 bg-white border border-gray-200 rounded-md'
  
  if (type === 'range') {
    return (
      <input
        type="range"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={`accent-emerald-500 ${className}`}
      />
    )
  }
  
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={`${baseClasses} px-3 py-2 ${className}`}
    />
  )
}

// Card component for consistent containers
interface CardProps {
  children: React.ReactNode
  variant?: 'default' | 'highlighted' | 'subtle'
  padding?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Card({ 
  children, 
  variant = 'default', 
  padding = 'md',
  className = ''
}: CardProps) {
  const variants = {
    default: 'bg-white border border-gray-200 shadow-sm',
    highlighted: 'bg-emerald-50 border border-emerald-200 shadow-sm',
    subtle: 'bg-gray-50 border border-gray-200'
  }
  
  const paddings = {
    sm: 'p-3',
    md: 'p-4', 
    lg: 'p-6'
  }
  
  return (
    <div className={`rounded-lg ${variants[variant]} ${paddings[padding]} ${className}`}>
      {children}
    </div>
  )
}

// Badge component
interface BadgeProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'accent' | 'warning' | 'success' | 'danger'
  size?: 'sm' | 'md'
}

export function Badge({ children, variant = 'secondary', size = 'sm' }: BadgeProps) {
  const variants = {
    primary: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    secondary: 'bg-blue-100 text-blue-700 border border-blue-200',
    accent: 'bg-purple-100 text-purple-700 border border-purple-200',
    warning: 'bg-amber-100 text-amber-700 border border-amber-200',
    success: 'bg-green-100 text-green-700 border border-green-200',
    danger: 'bg-red-100 text-red-700 border border-red-200'
  }
  
  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm'
  }
  
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${variants[variant]} ${sizes[size]}`}>
      {children}
    </span>
  )
}

// Status indicator
interface StatusProps {
  status: 'idle' | 'loading' | 'success' | 'error'
  message?: string
}

export function Status({ status, message }: StatusProps) {
  const variants = {
    idle: { bg: tokens.colors.gray[100], text: tokens.colors.gray.text.medium, icon: '⚪' },
    loading: { bg: 'bg-blue-100', text: 'text-blue-700', icon: '🔄' },
    success: { bg: 'bg-green-100', text: 'text-green-700', icon: '✅' },
    error: { bg: tokens.colors.danger[100], text: tokens.colors.danger.text, icon: '❌' }
  }
  
  const variant = variants[status]
  
  return (
    <div className={`flex items-center ${tokens.spacing.sm} px-3 py-2 ${tokens.radius.md} ${variant.bg}`}>
      <span className="text-sm">{variant.icon}</span>
      {message && <span className={`text-sm font-medium ${variant.text}`}>{message}</span>}
    </div>
  )
}