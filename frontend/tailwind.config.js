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
        // Custom dark mode color palette (multitalk-ui)
        dark: {
          bg: {
            primary: '#0f172a',
            secondary: '#1e293b',
            tertiary: '#334155',
          },
          surface: {
            primary: '#1e293b',
            secondary: '#334155',
            elevated: '#475569',
          },
          border: {
            primary: '#475569',
            secondary: '#64748b',
          },
          text: {
            primary: '#f1f5f9',
            secondary: '#cbd5e1',
            tertiary: '#94a3b8',
          }
        },
        // Screenwriting studio CSS-variable-based tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        surface: "hsl(var(--surface))",
        "phase-idea":   "hsl(var(--phase-idea))",
        "phase-story":  "hsl(var(--phase-story))",
        "phase-scenes": "hsl(var(--phase-scenes))",
        "phase-write":  "hsl(var(--phase-write))",
      },
      fontFamily: {
        display:    ['"Playfair Display"', 'Georgia', 'serif'],
        body:       ['"DM Sans"', 'system-ui', 'sans-serif'],
        screenplay: ['"Courier Prime"', '"Courier New"', 'monospace'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        // multitalk-ui dark mode gradients
        'gradient-dark-primary':  'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        'gradient-dark-surface':  'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
        'gradient-dark-elevated': 'linear-gradient(135deg, #475569 0%, #334155 100%)',
        // screenwriting
        'gradient-radial':  'radial-gradient(var(--tw-gradient-stops))',
        'shimmer-amber':    'linear-gradient(90deg, transparent 0%, hsl(38 92% 50% / 0.06) 50%, transparent 100%)',
      },
      keyframes: {
        "fade-in":        { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "fade-up":        { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "slide-in-right": { "0%": { opacity: "0", transform: "translateX(12px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
        "slide-in-left":  { "0%": { opacity: "0", transform: "translateX(-12px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
        "scale-in":       { "0%": { opacity: "0", transform: "scale(0.96)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        shimmer:          { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "pulse-warm":     { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.6" } },
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up":   { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "spin-slow":      { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
      },
      animation: {
        "fade-in":        "fade-in 0.4s ease-out",
        "fade-up":        "fade-up 0.5s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "slide-in-left":  "slide-in-left 0.3s ease-out",
        "scale-in":       "scale-in 0.2s ease-out",
        shimmer:          "shimmer 2s ease-in-out infinite",
        "pulse-warm":     "pulse-warm 2s ease-in-out infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "spin-slow":      "spin-slow 3s linear infinite",
      },
    },
  },
  plugins: [],
}
