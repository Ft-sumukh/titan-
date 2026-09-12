import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        titan: {
          dark: '#0a0d14',
          card: '#121824',
          border: '#1f293d',
          accent: '#3b82f6',
          p1: '#ef4444',
          p2: '#f97316',
          p3: '#eab308',
          p4: '#3b82f6',
        },
      },
    },
  },
  plugins: [],
};

export default config;
