import { type User } from '../contexts/AuthContext';
import { studios, standaloneApps, type StudioConfig, type StudioPageType } from '../lib/studioConfig';

interface Props {
  onNavigate: (page: StudioPageType) => void;
  user: User | null;
}

// Studio Card Component
function StudioCard({ studio, onClick }: { studio: StudioConfig; onClick: () => void }) {
  const isComingSoon = studio.comingSoon;

  return (
    <button
      onClick={onClick}
      disabled={isComingSoon}
      className={`group relative p-8 rounded-3xl bg-white/80 dark:bg-dark-surface-primary/80 backdrop-blur-sm border border-gray-300 dark:border-dark-border-primary/50 shadow-lg hover:shadow-2xl transform hover:scale-[1.02] transition-all duration-300 cursor-pointer overflow-hidden text-left w-full ${
        isComingSoon ? 'opacity-60 cursor-not-allowed hover:scale-100 hover:shadow-lg' : ''
      }`}
    >
      {/* Background Gradient */}
      <div className={`absolute inset-0 bg-gradient-to-br ${studio.gradient} opacity-0 ${!isComingSoon ? 'group-hover:opacity-5 dark:group-hover:opacity-10' : ''} transition-opacity duration-300`}></div>

      {/* Content */}
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className={`w-14 h-14 bg-gradient-to-br ${studio.gradient} rounded-2xl flex items-center justify-center text-2xl shadow-lg ${!isComingSoon ? 'group-hover:scale-110' : ''} transition-transform duration-300`}>
            {studio.icon}
          </div>
          {isComingSoon ? (
            <div className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-full">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Coming Soon</span>
            </div>
          ) : (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-dark-surface-secondary flex items-center justify-center">
                <span className="text-gray-600 dark:text-gray-300">→</span>
              </div>
            </div>
          )}
        </div>

        <h3 className={`text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-3 ${!isComingSoon ? 'group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-blue-600 group-hover:to-purple-600' : ''} transition-all duration-300`}>
          {studio.title}
        </h3>

        <p className="text-gray-600 dark:text-dark-text-secondary mb-6 leading-relaxed">
          {studio.description}
        </p>

        {/* App Icons Preview */}
        {!isComingSoon && studio.apps.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex -space-x-2">
              {studio.apps.slice(0, 4).map((app) => (
                <div
                  key={app.id}
                  className={`w-8 h-8 bg-gradient-to-br ${app.gradient} rounded-lg flex items-center justify-center text-sm shadow-md border-2 border-white dark:border-gray-800`}
                  title={app.title}
                >
                  {app.icon}
                </div>
              ))}
              {studio.apps.length > 4 && (
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300 border-2 border-white dark:border-gray-800">
                  +{studio.apps.length - 4}
                </div>
              )}
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {studio.apps.length} {studio.apps.length === 1 ? 'app' : 'apps'}
            </span>
          </div>
        )}

        {/* Features list */}
        {!isComingSoon && studio.apps.length > 0 && (
          <div className="space-y-2">
            {studio.apps.slice(0, 3).map((app) => (
              <div key={app.id} className="flex items-center gap-3 text-sm">
                <div className={`w-1.5 h-1.5 bg-gradient-to-r ${studio.gradient} rounded-full`}></div>
                <span className="text-gray-600 dark:text-dark-text-secondary">{app.title}</span>
              </div>
            ))}
            {studio.apps.length > 3 && (
              <div className="flex items-center gap-3 text-sm">
                <div className={`w-1.5 h-1.5 bg-gradient-to-r ${studio.gradient} rounded-full`}></div>
                <span className="text-gray-500 dark:text-gray-400">+{studio.apps.length - 3} more</span>
              </div>
            )}
          </div>
        )}

        {!isComingSoon && (
          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
            <div className={`inline-flex items-center gap-2 text-sm font-medium bg-gradient-to-r ${studio.gradient} bg-clip-text text-transparent`}>
              <span>Open Studio</span>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">→</span>
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

export default function Homepage({ onNavigate, user }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="text-center space-y-6 mb-16">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 rounded-3xl flex items-center justify-center shadow-2xl">
              <span className="text-white font-bold text-2xl">🎬</span>
            </div>
          </div>
          <h1 className="text-5xl md:text-7xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            sideOUTsticks
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Your complete AI-powered media creation suite.
          </p>

          {/* User Welcome Section */}
          {user && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <div className="flex items-center gap-3 px-6 py-3 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-md">
                {user.profile_picture_url ? (
                  <img
                    src={user.profile_picture_url}
                    alt="Profile"
                    className="w-12 h-12 rounded-full object-cover border-2 border-purple-200"
                  />
                ) : (
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <span className="text-white text-lg font-bold">
                      {(user.full_name?.[0] || user.email?.[0] || 'U').toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="text-left">
                  <p className="text-sm text-gray-500">Welcome back,</p>
                  <p className="text-lg font-bold text-gray-900">{user.full_name || user.email}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Studios Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-8 mb-8">
          {studios.map((studio) => (
            <StudioCard
              key={studio.id}
              studio={studio}
              onClick={() => onNavigate(studio.id as StudioPageType)}
            />
          ))}
        </div>

        {/* Standalone Apps (History) - Full Width */}
        <div className="mb-16">
          {standaloneApps.map((app) => (
            <button
              key={app.id}
              onClick={() => onNavigate(app.id as StudioPageType)}
              className="group relative w-full p-8 rounded-3xl bg-white/80 dark:bg-dark-surface-primary/80 backdrop-blur-sm border border-gray-300 dark:border-dark-border-primary/50 shadow-lg hover:shadow-2xl transform hover:scale-[1.01] transition-all duration-300 cursor-pointer overflow-hidden text-left"
            >
              {/* Background Gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${app.gradient} opacity-0 group-hover:opacity-5 dark:group-hover:opacity-10 transition-opacity duration-300`}></div>

              {/* Content - Horizontal Layout for Full Width */}
              <div className="relative z-10 flex items-center justify-between gap-8">
                <div className="flex items-center gap-6">
                  <div className={`w-16 h-16 bg-gradient-to-br ${app.gradient} rounded-2xl flex items-center justify-center text-3xl shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    {app.icon}
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 dark:text-dark-text-primary mb-2 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-blue-600 group-hover:to-purple-600 transition-all duration-300">
                      {app.title}
                    </h3>
                    <p className="text-gray-600 dark:text-dark-text-secondary leading-relaxed max-w-2xl">
                      {app.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-8">
                  <div className="hidden md:flex items-center gap-4">
                    {app.features.map((feature, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm px-4 py-2 bg-gray-100 dark:bg-dark-surface-secondary rounded-xl">
                        <div className={`w-1.5 h-1.5 bg-gradient-to-r ${app.gradient} rounded-full`}></div>
                        <span className="text-gray-600 dark:text-dark-text-secondary">{feature}</span>
                      </div>
                    ))}
                  </div>
                  <div className={`inline-flex items-center gap-2 text-lg font-medium bg-gradient-to-r ${app.gradient} bg-clip-text text-transparent`}>
                    <span>View All</span>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-2xl">→</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* External Tools Section */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-dark-text-primary mb-4">External Tools</h2>
            <p className="text-lg text-gray-600 dark:text-dark-text-secondary max-w-2xl mx-auto">
              Access powerful development and workflow tools to enhance your AI media creation process.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <button
              onClick={() => window.open('https://comfy.vapai.studio', '_blank')}
              className="group p-6 rounded-3xl bg-white/80 dark:bg-dark-surface-primary/80 backdrop-blur-sm border border-gray-300 dark:border-dark-border-primary/50 shadow-lg hover:shadow-2xl transform hover:scale-[1.02] transition-all duration-300 cursor-pointer text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl flex items-center justify-center text-2xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                  🔧
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-dark-surface-secondary flex items-center justify-center">
                    <span className="text-gray-600 dark:text-gray-300">↗</span>
                  </div>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-3 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-orange-600 group-hover:to-red-600 transition-all duration-300">
                ComfyUI
              </h3>
              <p className="text-gray-600 dark:text-dark-text-secondary mb-4 leading-relaxed">
                Advanced node-based workflow editor for AI image and video generation with custom pipelines.
              </p>
              <div className="inline-flex items-center gap-2 text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">
                <span>Open Workflow Editor</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">→</span>
              </div>
            </button>

            <button
              onClick={() => window.open('https://notebook.vapai.studio', '_blank')}
              className="group p-6 rounded-3xl bg-white/80 dark:bg-dark-surface-primary/80 backdrop-blur-sm border border-gray-300 dark:border-dark-border-primary/50 shadow-lg hover:shadow-2xl transform hover:scale-[1.02] transition-all duration-300 cursor-pointer text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-2xl flex items-center justify-center text-2xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                  📓
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-dark-surface-secondary flex items-center justify-center">
                    <span className="text-gray-600 dark:text-gray-300">↗</span>
                  </div>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-3 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-blue-600 group-hover:to-cyan-600 transition-all duration-300">
                Jupyter Notebook
              </h3>
              <p className="text-gray-600 dark:text-dark-text-secondary mb-4 leading-relaxed">
                Interactive development environment for data science, AI experiments, and custom model training.
              </p>
              <div className="inline-flex items-center gap-2 text-sm font-medium bg-gradient-to-r from-blue-500 to-cyan-600 bg-clip-text text-transparent">
                <span>Launch Notebook</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">→</span>
              </div>
            </button>

            <button
              onClick={() => window.open('https://n8n.vapai.studio', '_blank')}
              className="group p-6 rounded-3xl bg-white/80 dark:bg-dark-surface-primary/80 backdrop-blur-sm border border-gray-300 dark:border-dark-border-primary/50 shadow-lg hover:shadow-2xl transform hover:scale-[1.02] transition-all duration-300 cursor-pointer text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl flex items-center justify-center text-2xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                  ⚡
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-dark-surface-secondary flex items-center justify-center">
                    <span className="text-gray-600 dark:text-gray-300">↗</span>
                  </div>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-3 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-green-600 group-hover:to-emerald-600 transition-all duration-300">
                n8n Automation
              </h3>
              <p className="text-gray-600 dark:text-dark-text-secondary mb-4 leading-relaxed">
                Powerful workflow automation platform to connect apps and automate AI-powered media pipelines.
              </p>
              <div className="inline-flex items-center gap-2 text-sm font-medium bg-gradient-to-r from-green-500 to-emerald-600 bg-clip-text text-transparent">
                <span>Open Automation</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">→</span>
              </div>
            </button>
          </div>
        </div>

        {/* Footer Info */}
        <div className="text-center space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
            Configure your ComfyUI URL in the navigation bar to get started. All processing happens in real-time with professional-grade AI models.
          </p>
        </div>
      </div>
    </div>
  );
}
