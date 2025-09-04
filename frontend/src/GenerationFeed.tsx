import UnifiedFeed from './components/UnifiedFeed'

export default function GenerationFeed() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-indigo-50">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 bg-clip-text text-transparent">
            Generation Feed
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Your complete history of AI-generated content - videos and edited images all in one place.
          </p>
        </div>

        {/* Unified Feed */}
        <div className="max-w-6xl mx-auto">
          <UnifiedFeed 
            comfyUrl=""  // Not needed for generation feed
            config={{
              type: 'both',
              title: 'All Generations',
              showCompletedOnly: true,
              maxItems: 50,
              showFixButton: false,
              showProgress: false
            }}
          />
        </div>
      </div>
    </div>
  )
}