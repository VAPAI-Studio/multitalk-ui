import ImageFeed from '../components/ImageFeed'
import VideoFeed from '../components/VideoFeed'

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

        {/* Separate Feeds */}
        <div className="max-w-6xl mx-auto space-y-12">
          {/* Video Feed */}
          <VideoFeed 
            comfyUrl=""  // Not needed for generation feed
            config={{
              showCompletedOnly: true,
              maxItems: 25,
              showFixButton: false,
              showProgress: false
            }}
          />

          {/* Image Feed */}
          <ImageFeed 
            config={{
              showCompletedOnly: true,
              maxItems: 25,
              showFixButton: false,
              showProgress: false
            }}
          />
        </div>
      </div>
    </div>
  )
}