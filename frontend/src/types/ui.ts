// UI-related types
export interface LoadingState {
  isLoading: boolean
  message?: string
}

export interface ErrorState {
  hasError: boolean
  message?: string
  code?: string
}

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
}

export interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
}

export interface FilterProps {
  showAll: boolean
  onToggleShowAll: (value: boolean) => void
}

// Navigation types
export type PageType = 
  | "home" 
  | "multitalk-one" 
  | "multitalk-multiple" 
  | "video-lipsync" 
  | "image-edit" 
  | "generation-feed"
  | "character-caption"

export interface NavigationProps {
  onNavigate: (page: PageType) => void
}

// Form types
export interface FormState<T = any> {
  values: T
  errors: Record<string, string>
  isSubmitting: boolean
  isValid: boolean
}

// File upload types
export interface FileUploadState {
  file: File | null
  preview: string | null
  isUploading: boolean
  progress: number
  error: string | null
}

// Status colors for different states
export type StatusColor = 
  | 'bg-green-100 text-green-800'
  | 'bg-yellow-100 text-yellow-800'
  | 'bg-blue-100 text-blue-800'
  | 'bg-red-100 text-red-800'
  | 'bg-gray-100 text-gray-800'