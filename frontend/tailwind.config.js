/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom dark mode color palette
        dark: {
          bg: {
            primary: '#0f172a',    // slate-900
            secondary: '#1e293b',  // slate-800
            tertiary: '#334155',   // slate-700
          },
          surface: {
            primary: '#1e293b',    // slate-800
            secondary: '#334155',  // slate-700
            elevated: '#475569',   // slate-600
          },
          border: {
            primary: '#475569',    // slate-600
            secondary: '#64748b',  // slate-500
          },
          text: {
            primary: '#f1f5f9',    // slate-100
            secondary: '#cbd5e1',  // slate-300
            tertiary: '#94a3b8',   // slate-400
          }
        }
      },
      backgroundImage: {
        // Dark mode gradients to maintain aesthetic
        'gradient-dark-primary': 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        'gradient-dark-surface': 'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
        'gradient-dark-elevated': 'linear-gradient(135deg, #475569 0%, #334155 100%)',
      }
    },
  },
  plugins: [],
}
  