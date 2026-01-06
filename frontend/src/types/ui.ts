// UI-related types
import type { EditedImage } from './api'

// Style transfer data from backend
export interface StyleTransfer {
  id: string
  created_at: string
  source_image_url: string
  style_image_url: string
  prompt: string
  result_image_url?: string
  workflow_name: string
  model_used?: string
  processing_time_seconds?: number
  user_ip?: string
  status: string
  comfyui_prompt_id?: string
  error_message?: string
  updated_at?: string
}

// Unified image item for feeds (combines edited images and style transfers)
export interface ImageItem {
  id: string
  type: 'edited-image' | 'style-transfer'
  created_at: string
  title: string
  status: string
  preview_url: string
  result_url?: string
  all_result_urls?: string[] // All output images for multi-image jobs (like image-grid)
  processing_time?: number
  source_image_url: string
  prompt: string
  workflow_name: string
  model_used?: string
  user_ip?: string
  metadata?: EditedImage | StyleTransfer // Original data from backend
}

// Feed configuration
export interface FeedConfig {
  useNewJobSystem?: boolean
  workflowName?: string
  showCompletedOnly?: boolean
  maxItems?: number
  showFixButton?: boolean
  showProgress?: boolean
  pageContext?: string
  title?: string
}

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
  | "image-grid"
  | "generation-feed"
  | "character-caption"
  | "wan-i2v"
  | "style-transfer"
  | "lora-trainer"

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