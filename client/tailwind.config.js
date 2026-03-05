/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#10b981', // emerald-500
          hover: '#059669', // emerald-600
        },
        secondary: {
          DEFAULT: '#3b82f6', // blue-500
          hover: '#2563eb', // blue-600
        }
      },
      fontFamily: {
        cairo: ['Cairo', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
