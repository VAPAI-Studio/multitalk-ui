import React, { useEffect } from 'react'
import { Button } from './DesignSystem'

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className ?? "block text-xs font-medium text-gray-900 dark:text-dark-text-primary"}>{children}</label>
}

export function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-dark-border-primary p-6 bg-white dark:bg-dark-surface-primary shadow-sm transition-all duration-200 hover:shadow-md">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary mb-4 flex items-center gap-3">
        <span className="inline-block w-1 h-6 bg-emerald-500 rounded-full" />
        {title}
      </h2>
      {children}
    </section>
  )
}

export function Modal({ isOpen, onClose, children }: { 
  isOpen: boolean; 
  onClose: () => void; 
  children: React.ReactNode 
}) {
  // Handle escape key
  useEffect(() => {
    if (!isOpen) return
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])
  
  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-black/60 p-4 backdrop-blur-sm transition-all duration-300"
      role="dialog"
      aria-modal
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-4xl rounded-lg bg-white dark:bg-dark-surface-primary p-6 shadow-xl transform transition-all duration-300 scale-100">
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-dark-surface-secondary px-2 py-1 rounded">
            ESC
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 rounded-full"
            aria-label="Close modal"
          >
            ×
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}