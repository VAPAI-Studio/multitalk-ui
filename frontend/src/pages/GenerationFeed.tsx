import { useState, useEffect } from 'react'
import GenerationFeedComponent from '../components/GenerationFeed'
import {
  WORKFLOW_DISPLAY_NAMES,
  getWorkflowMediaType
} from '../constants/workflowNames'

// Build workflow options from shared constant
const WORKFLOW_OPTIONS = Object.entries(WORKFLOW_DISPLAY_NAMES).map(([value, label]) => ({
  value,
  label,
  type: getWorkflowMediaType(value)
}))

export default function GenerationFeed() {
  const [mediaType, setMediaType] = useState<'video' | 'image' | 'all'>('all')
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  // Load preferences from localStorage
  useEffect(() => {
    const savedMediaType = localStorage.getItem('generationFeed_mediaType')
    const savedWorkflows = localStorage.getItem('generationFeed_workflows')

    if (savedMediaType && ['video', 'image', 'all'].includes(savedMediaType)) {
      setMediaType(savedMediaType as 'video' | 'image' | 'all')
    }
    if (savedWorkflows) {
      try {
        const parsed = JSON.parse(savedWorkflows) as string[]
        // Only keep workflows that exist in WORKFLOW_OPTIONS
        const validWorkflowValues = WORKFLOW_OPTIONS.map(w => w.value)
        const validSavedWorkflows = parsed.filter(w => validWorkflowValues.includes(w))

        // If some workflows were invalid, clear the localStorage
        if (validSavedWorkflows.length !== parsed.length) {
          console.log('[GenerationFeed] Cleared invalid workflow filters:',
            parsed.filter(w => !validWorkflowValues.includes(w)))
          localStorage.setItem('generationFeed_workflows', JSON.stringify(validSavedWorkflows))
        }

        setSelectedWorkflows(validSavedWorkflows)
      } catch (e) {
        console.error('Error parsing saved workflows:', e)
        // Clear corrupted localStorage
        localStorage.removeItem('generationFeed_workflows')
      }
    }
  }, [])

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('generationFeed_mediaType', mediaType)
  }, [mediaType])

  useEffect(() => {
    localStorage.setItem('generationFeed_workflows', JSON.stringify(selectedWorkflows))
  }, [selectedWorkflows])

  // Toggle a workflow in the selection
  const toggleWorkflow = (workflowValue: string) => {
    setSelectedWorkflows(prev =>
      prev.includes(workflowValue)
        ? prev.filter(w => w !== workflowValue)
        : [...prev, workflowValue]
    )
  }

  // Clear all workflow selections
  const clearAllWorkflows = () => {
    setSelectedWorkflows([])
  }

  // Select all workflows of current media type
  const selectAllVisible = () => {
    const visibleWorkflows = WORKFLOW_OPTIONS
      .filter(w => mediaType === 'all' || w.type === mediaType)
      .map(w => w.value)
    setSelectedWorkflows(visibleWorkflows)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center space-y-4 mb-8">
          <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 bg-clip-text text-transparent">
            Generation Feed
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Your complete history of AI-generated content - videos and images all in one place.
          </p>
        </div>

        {/* Filter Bar */}
        <div className="max-w-4xl mx-auto mb-8">
          <div className="bg-white dark:bg-dark-surface-primary rounded-2xl shadow-lg border border-gray-200 dark:border-dark-border-primary p-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* Media Type Filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-dark-text-secondary">Show:</span>
                <div className="flex rounded-xl border border-gray-300 dark:border-dark-border-primary overflow-hidden">
                  <button
                    onClick={() => setMediaType('all')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      mediaType === 'all'
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                        : 'bg-white dark:bg-dark-surface-secondary text-gray-600 dark:text-dark-text-secondary hover:bg-gray-50 dark:hover:bg-dark-surface-elevated'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setMediaType('video')}
                    className={`px-4 py-2 text-sm font-medium border-l border-gray-300 dark:border-dark-border-primary transition-colors ${
                      mediaType === 'video'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-dark-surface-secondary text-gray-600 dark:text-dark-text-secondary hover:bg-gray-50 dark:hover:bg-dark-surface-elevated'
                    }`}
                  >
                    Videos
                  </button>
                  <button
                    onClick={() => setMediaType('image')}
                    className={`px-4 py-2 text-sm font-medium border-l border-gray-300 dark:border-dark-border-primary transition-colors ${
                      mediaType === 'image'
                        ? 'bg-pink-600 text-white'
                        : 'bg-white dark:bg-dark-surface-secondary text-gray-600 dark:text-dark-text-secondary hover:bg-gray-50 dark:hover:bg-dark-surface-elevated'
                    }`}
                  >
                    Images
                  </button>
                </div>
              </div>

              {/* Workflow Multi-Select Dropdown */}
              <div className="relative flex-1 min-w-[200px]">
                <span className="text-sm font-medium text-gray-700 dark:text-dark-text-secondary mr-2">Workflows:</span>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="w-full px-4 py-2 text-left bg-white dark:bg-dark-surface-secondary border border-gray-300 dark:border-dark-border-primary rounded-xl hover:bg-gray-50 dark:hover:bg-dark-surface-elevated transition-colors flex items-center justify-between"
                >
                  <span className="text-sm text-gray-700 dark:text-dark-text-secondary truncate">
                    {selectedWorkflows.length === 0
                      ? 'All workflows'
                      : selectedWorkflows.length === 1
                        ? WORKFLOW_OPTIONS.find(w => w.value === selectedWorkflows[0])?.label || selectedWorkflows[0]
                        : `${selectedWorkflows.length} workflows selected`}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full bg-white dark:bg-dark-surface-primary border border-gray-300 dark:border-dark-border-primary rounded-xl shadow-xl max-h-80 overflow-y-auto">
                    {/* Quick actions */}
                    <div className="sticky top-0 bg-gray-50 dark:bg-dark-surface-secondary border-b border-gray-200 dark:border-dark-border-primary p-2 flex gap-2">
                      <button
                        onClick={clearAllWorkflows}
                        className="px-3 py-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
                      >
                        Clear All
                      </button>
                      <button
                        onClick={selectAllVisible}
                        className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors"
                      >
                        Select All
                      </button>
                    </div>

                    {/* Video workflows section */}
                    {(mediaType === 'all' || mediaType === 'video') && (
                      <>
                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-blue-50 border-b border-gray-100">
                          Video Workflows
                        </div>
                        {WORKFLOW_OPTIONS.filter(w => w.type === 'video').map(workflow => (
                          <label
                            key={workflow.value}
                            className="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedWorkflows.includes(workflow.value)}
                              onChange={() => toggleWorkflow(workflow.value)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="ml-3 text-sm text-gray-700">{workflow.label}</span>
                          </label>
                        ))}
                      </>
                    )}

                    {/* Image workflows section */}
                    {(mediaType === 'all' || mediaType === 'image') && (
                      <>
                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-pink-50 border-b border-gray-100">
                          Image Workflows
                        </div>
                        {WORKFLOW_OPTIONS.filter(w => w.type === 'image').map(workflow => (
                          <label
                            key={workflow.value}
                            className="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedWorkflows.includes(workflow.value)}
                              onChange={() => toggleWorkflow(workflow.value)}
                              className="w-4 h-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                            />
                            <span className="ml-3 text-sm text-gray-700">{workflow.label}</span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Selected workflow tags */}
              {selectedWorkflows.length > 0 && (
                <div className="w-full flex flex-wrap gap-2 mt-2">
                  {selectedWorkflows.map(wf => {
                    const workflow = WORKFLOW_OPTIONS.find(w => w.value === wf)
                    return (
                      <span
                        key={wf}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                          workflow?.type === 'video'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-pink-100 text-pink-700'
                        }`}
                      >
                        {workflow?.label || wf}
                        <button
                          onClick={() => toggleWorkflow(wf)}
                          className="hover:bg-black/10 rounded-full p-0.5"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Click outside to close dropdown */}
        {isDropdownOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsDropdownOpen(false)}
          />
        )}

        {/* Unified Feed */}
        <div className="max-w-6xl mx-auto">
          <GenerationFeedComponent
            config={{
              mediaType: mediaType,
              workflowNames: selectedWorkflows.length > 0 ? selectedWorkflows : undefined,
              showCompletedOnly: false,
              maxItems: 25,
              showFixButton: false,
              showProgress: true,
              showMediaTypeToggle: false
            }}
          />
        </div>
      </div>
    </div>
  )
}
