/** Every color maps to a CSS variable from tokens.css — components never hardcode hex. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-elevated': 'var(--bg-elevated)',
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        positive: 'var(--positive)',
        'positive-soft': 'var(--positive-soft)',
        negative: 'var(--negative)',
        'negative-soft': 'var(--negative-soft)',
        warning: 'var(--warning)',
        'warning-soft': 'var(--warning-soft)',
      },
      // SR-DL-001 radius is 3px. Override the small/medium steps used across the
      // console so components read as engineering-drawing, not rounded chips.
      // rounded-full is untouched (pills, avatars stay circular).
      borderRadius: {
        sm: '2px',
        DEFAULT: '3px',
        md: '3px',
        lg: '4px',
        xl: '6px',
      },
      fontFamily: {
        // SR-DL-001 type roles. Archivo speaks for the system, Source Serif 4
        // speaks to the reader, IBM Plex Mono speaks in evidence.
        heading: ['Archivo', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        ui: ['Archivo', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
