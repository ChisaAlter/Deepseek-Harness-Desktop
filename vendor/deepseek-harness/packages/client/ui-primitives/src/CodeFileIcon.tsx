import { useId } from 'react'
import type { ReactNode } from 'react'
import type { IconProps } from './icons/props.ts'
import type { CodeFileType } from './code-file-types.ts'

/** Non-localizable letterforms that are part of the source-format artwork. */
const CODE_MARKS = {
  c: 'C',
  cpp: 'C',
  csharp: 'C',
  css: 'CSS',
  env: 'ENV',
  erlang: 'E',
  ini: 'INI',
  javascript: 'JS',
  objectiveC: 'OC',
  perl: 'PL',
  php: 'PHP',
  r: 'R',
  toml: 'TOML',
  typescript: 'TS',
  yaml: 'YAML',
  zig: 'ZIG',
} as const

/**
 * Render one full-color square code-file glyph from the embedded icon set.
 * @param props - Detailed code type, optional size, and optional CSS class.
 * @returns The selected decorative SVG with its identifying palette intact.
 */
export function CodeFileIcon({ type, size = 20, className }: IconProps & { readonly type: CodeFileType }): ReactNode {
  const gradientId = useId()
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {codeFileArtwork(type, gradientId)}
    </svg>
  )
}

function codeFileArtwork(type: CodeFileType, gradientId: string): ReactNode {
  switch (type) {
    case 'angular':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#DD0031"/>
          <path fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" d="m10 3.4 6 2-1 8-5 3-5-3-1-8z"/>
          <path fill="#fff" d="m10 5.3-3.7 8.2h1.9l.7-1.8h2.2l.7 1.8h1.9zm0 3.4.5 1.4h-1z"/>
        </>
      )
    case 'c':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#659AD2"/>
          <path fill="none" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" d="m10 3.4 6 3.3v6.6l-6 3.3-6-3.3V6.7z"/>
          <text x="10" y="13.5" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9.5" fontWeight="800" fill="#fff">
            {CODE_MARKS.c}
          </text>
        </>
      )
    case 'clojure':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#344D70"/>
          <circle cx="10" cy="10" r="6.6" fill="#fff"/>
          <path fill="#63B132" d="M9.5 3.5a6.5 6.5 0 0 0-4.7 10.8c1-2.6 2.5-4.3 4.3-5.3-1-1.5-.8-3.4.4-5.5z"/>
          <path fill="#5881D8" d="M10.7 3.5c1.8 1.6 2.5 3.3 2 5.1 1.5 1.1 2.4 2.8 2.7 5.2a6.5 6.5 0 0 0-4.7-10.3z"/>
          <path fill="#90B4FE" d="M12 9.8c-1.6.3-2.8 2.1-3.8 5.4a6.4 6.4 0 0 0 6.3-.7c-.2-2.1-1-3.7-2.5-4.7z"/>
        </>
      )
    case 'cmake':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#263A55"/>
          <path fill="#4D9DCC" d="M10 3 4 16h4.6z"/>
          <path fill="#43A047" d="M10 3 8.6 16H16z"/>
          <path fill="#E53935" d="m10 3 6 13-6-5z"/>
          <path fill="#fff" d="m10 6 2.3 5.1-2.3-1.8-.8 2.9z"/>
        </>
      )
    case 'cpp':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#00599C"/>
          <path fill="none" stroke="#fff" strokeWidth="1.15" strokeLinejoin="round" d="m10 3.4 6 3.3v6.6l-6 3.3-6-3.3V6.7z"/>
          <text x="7.8" y="13" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8.2" fontWeight="800" fill="#fff">
            {CODE_MARKS.cpp}
          </text>
          <path stroke="#fff" strokeWidth="1.1" d="M12 8.8v3.8m-1.9-1.9h3.8m2-1.9v3.8M14 10.7h3.8"/>
        </>
      )
    case 'csharp':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#68217A"/>
          <path fill="none" stroke="#fff" strokeWidth="1.15" strokeLinejoin="round" d="m10 3.4 6 3.3v6.6l-6 3.3-6-3.3V6.7z"/>
          <text x="7.6" y="13" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8.2" fontWeight="800" fill="#fff">
            {CODE_MARKS.csharp}
          </text>
          <path stroke="#fff" strokeWidth=".95" d="M11.6 8.6h5m-5 3h5m-3.3-5v7m1.8-7v7"/>
        </>
      )
    case 'css':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#1572B6"/>
          <text x="10" y="12.8" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="6.2" fontWeight="900" fill="#fff">
            {CODE_MARKS.css}
          </text>
        </>
      )
    case 'dart':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#0175C2"/>
          <path fill="#fff" d="M5 4h6.5l4.5 4.5-3.2 7.5H8.5L4 11.5z"/>
          <path fill="#13B9FD" d="m5 4 4 5.5h7L11.5 4zm4 5.5 3.8 6.5H8.5z"/>
        </>
      )
    case 'docker':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#2496ED"/>
          <path fill="#fff" d="M3 10h11.7c.2-1.2.9-2 2-2.5.5 1 .4 2-.3 2.7.5.1 1 .1 1.5-.1-.7 3.9-3.6 5.9-8.2 5.9C6 16 3.4 14 3 10z"/>
          <g fill="#2496ED">
            <path d="M4.5 7h2v2h-2zm2.6 0h2v2h-2zm2.6 0h2v2h-2zM7.1 4.5h2v2h-2zm2.6 0h2v2h-2zm2.6 2.5h2v2h-2z"/>
          </g>
        </>
      )
    case 'elixir':
      return (
        <>
          <defs>
            <linearGradient id={gradientId} x1="1" y1="19" x2="19" y2="1">
              <stop stopColor="#4B275F"/>
              <stop offset="1" stopColor="#8E6AAF"/>
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="18" height="18" rx="4" fill={`url(#${gradientId})`}/>
          <path fill="#fff" d="M10.7 3c.2 3.5-4.3 5.8-4.3 9.4 0 2.9 1.8 4.9 4.4 4.9 2.8 0 4.7-1.9 4.7-4.6 0-4.3-3.4-7-4.8-9.7z"/>
          <path fill="#8E6AAF" d="M10.7 4.8c-.4 3.1-3 5.4-3 7.8 0 1.5.7 2.6 1.9 3-1-3.6 2.8-5.8 1.1-10.8z"/>
        </>
      )
    case 'env':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#ECD53F"/>
          <text x="10" y="13.2" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="6.8" fontWeight="900" fill="#24292F">
            {CODE_MARKS.env}
          </text>
        </>
      )
    case 'erlang':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#A90533"/>
          <circle cx="10" cy="10" r="6.4" fill="none" stroke="#fff" strokeWidth="1"/>
          <text x="10" y="13.8" textAnchor="middle" fontFamily="Georgia,serif" fontSize="10.5" fontWeight="700" fill="#fff">
            {CODE_MARKS.erlang}
          </text>
        </>
      )
    case 'flutter':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#027DFD"/>
          <path fill="#fff" d="m4 10 6-6h4L8 10zm4 0 2.5-2.5H14L11.5 10l2.5 2.5h-3.5z"/>
          <path fill="#B9E6FF" d="m8 10 4.5 4.5-2 2L4 10z"/>
        </>
      )
    case 'git':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#F05032"/>
          <rect x="5" y="5" width="10" height="10" rx="1.4" transform="rotate(45 10 10)" fill="#fff"/>
          <path d="m7.7 7.4 4.9 4.9M9.9 9.6v3.6" fill="none" stroke="#F05032" strokeWidth="1.15"/>
          <circle cx="7.7" cy="7.4" r="1.1" fill="#F05032"/>
          <circle cx="12.6" cy="12.3" r="1.1" fill="#F05032"/>
          <circle cx="9.9" cy="13.2" r="1.1" fill="#F05032"/>
        </>
      )
    case 'go':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#00ADD8"/>
          <path fill="#fff" d="M3.5 8h6v1.6H5.2a2 2 0 0 0 0 .8h2.4v-.5H6.8V8.7h3.7c.3 3-1 4.4-3.6 4.4S3 11.7 3 9.7c0-.6.2-1.2.5-1.7Zm9.3 0h1.7c1.6 0 2.5 1 2.5 2.5s-.9 2.6-2.5 2.6h-1.7c-1.6 0-2.5-1-2.5-2.6S11.2 8 12.8 8Zm.3 1.6c-.7 0-1 .3-1 .9s.3 1 1 1h1.1c.7 0 1-.4 1-1s-.3-.9-1-.9z"/>
        </>
      )
    case 'graphql':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#E10098"/>
          <path d="m10 4 5.2 3v6L10 16l-5.2-3V7zm-5 3.2h10M5 12.8h10M10 4l5 8.8M10 4l-5 8.8M10 16 5 7.2m5 8.8 5-8.8" stroke="#fff" strokeWidth=".8"/>
          <g fill="#fff">
            <circle cx="10" cy="4" r="1"/>
            <circle cx="15.2" cy="7" r="1"/>
            <circle cx="15.2" cy="13" r="1"/>
            <circle cx="10" cy="16" r="1"/>
            <circle cx="4.8" cy="13" r="1"/>
            <circle cx="4.8" cy="7" r="1"/>
          </g>
        </>
      )
    case 'haskell':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#5D4F85"/>
          <path fill="#fff" d="m3.5 4.5 3.5 5.5-3.5 5.5h2.7L9.8 10 6.2 4.5zm4 0L11 10l-3.5 5.5h2.7l3.5-5.5-3.5-5.5zm5 3.1 1 1.6H17V7.6zm1.4 3 1 1.7H17v-1.7z"/>
        </>
      )
    case 'ini':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#6E7781"/>
          <text x="10" y="13.2" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="7.2" fontWeight="800" fill="#fff">
            {CODE_MARKS.ini}
          </text>
        </>
      )
    case 'java':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#427A9B"/>
          <path d="M9 3.1c2.3 1.7-2.4 2.5.5 4.5m2-4.9c2.3 1.9-3.2 2.9-.2 5" stroke="#FF6B57" strokeWidth="1.15" strokeLinecap="round"/>
          <path d="M5.4 8.6h8c-.2 3.7-1.3 4.8-4 4.8-2.6 0-3.8-1.2-4-4.8Zm7.8 1h1c1.6 0 1.6 2.5-.5 2.5M4.7 14.8c2.5.8 7.5.8 10.1 0M5.7 16.5c2 .5 6.3.6 8.3 0" stroke="#fff" strokeWidth="1.05" strokeLinecap="round"/>
        </>
      )
    case 'javascript':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#F7DF1E"/>
          <text x="10" y="14" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8.4" fontWeight="800" fill="#191919">
            {CODE_MARKS.javascript}
          </text>
        </>
      )
    case 'json':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#4A4A4A"/>
          <text x="10" y="13.6" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9.4" fontWeight="700" fill="#F7DF1E">
            {'{ }'}
          </text>
        </>
      )
    case 'kotlin':
      return (
        <>
          <defs>
            <linearGradient id={gradientId} x1="1" y1="19" x2="19" y2="1">
              <stop stopColor="#0095D5"/>
              <stop offset=".5" stopColor="#7F52FF"/>
              <stop offset="1" stopColor="#F88909"/>
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="18" height="18" rx="4" fill={`url(#${gradientId})`}/>
          <path fill="#fff" d="M5 5h2.2v4.1L11.1 5h3l-4.6 4.6 5 5.4h-3l-3.6-4-.7.7V15H5z"/>
        </>
      )
    case 'lua':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#000080"/>
          <circle cx="9" cy="11" r="5.7" fill="none" stroke="#fff" strokeWidth="1"/>
          <circle cx="13.1" cy="6.6" r="2.3" fill="#000080" stroke="#fff" strokeWidth="1"/>
          <circle cx="13.8" cy="5.9" r=".65" fill="#fff"/>
          <circle cx="10.7" cy="9" r=".9" fill="#fff"/>
        </>
      )
    case 'makefile':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#427819"/>
          <path fill="#fff" d="m5 4.5 2.3 2.3 2.3-2.3L11 5.9 8.7 8.2l2.4 2.4L9.7 12l-2.4-2.4L5 11.9 3.6 10.5l2.3-2.3-2.3-2.3zm7 6.5h4v1.5h-4zm0 2.8h4v1.5h-4z"/>
        </>
      )
    case 'node':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#539E43"/>
          <path fill="none" stroke="#fff" strokeWidth="1.35" strokeLinejoin="round" d="m10 3.5 6 3.3v6.4l-6 3.3-6-3.3V6.8z"/>
          <path fill="#fff" d="M6.8 7h1.8l2.8 4.2V7h1.8v6h-1.8L8.6 8.8V13H6.8z"/>
        </>
      )
    case 'objective-c':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#438EFF"/>
          <text x="10" y="13.2" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="7.2" fontWeight="800" fill="#fff">
            {CODE_MARKS.objectiveC}
          </text>
        </>
      )
    case 'perl':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#39457E"/>
          <text x="10" y="13.3" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="7.8" fontWeight="800" fill="#fff">
            {CODE_MARKS.perl}
          </text>
        </>
      )
    case 'php':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#777BB4"/>
          <ellipse cx="10" cy="10" rx="7" ry="4.5" fill="none" stroke="#fff" strokeWidth="1"/>
          <text x="10" y="12.1" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="5.8" fontStyle="italic" fontWeight="800" fill="#fff">
            {CODE_MARKS.php}
          </text>
        </>
      )
    case 'powershell':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#2671BE"/>
          <path fill="#fff" fillOpacity=".16" d="M5.5 4h11l-3.5 12H2z"/>
          <path d="m6.5 6.5 3 3-4.2 3.2m4 1h4" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </>
      )
    case 'protobuf':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#4285F4"/>
          <path fill="none" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" d="m10 3.5 6 3.3v6.4l-6 3.3-6-3.3V6.8z"/>
          <path fill="#fff" d="M6.5 6.5h4.4c2.3 0 3.6 1.2 3.6 3.1s-1.3 3.1-3.6 3.1H9v2H6.5zM9 8.4v2.4h1.6c.8 0 1.2-.4 1.2-1.2s-.4-1.2-1.2-1.2z"/>
        </>
      )
    case 'python':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#306998"/>
          <path fill="#fff" d="M9.8 3.2c-3.5 0-3.6 1.5-3.6 1.5v2.5H10V8H5s-2.2-.2-2.2 3.3 2 3.4 2 3.4h1.8v-2.6c0-2 1.8-2.4 3.2-2.4H13c1.8 0 2.4-1.4 2.4-3.2S13.8 3.2 12 3.2z"/>
          <circle cx="8.1" cy="5.1" r=".65" fill="#306998"/>
          <path fill="#FFD43B" d="M10.2 16.8c3.5 0 3.6-1.5 3.6-1.5v-2.5H10V12h5s2.2.2 2.2-3.3-2-3.4-2-3.4h-1.8v2.6c0 2-1.8 2.4-3.2 2.4H7c-1.8 0-2.4 1.4-2.4 3.2s1.6 3.3 3.4 3.3z"/>
          <circle cx="11.9" cy="14.9" r=".65" fill="#306998"/>
        </>
      )
    case 'r':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#276DC3"/>
          <ellipse cx="9" cy="9.4" rx="6.4" ry="4.5" fill="#fff" fillOpacity=".9"/>
          <ellipse cx="8.3" cy="8.9" rx="4.5" ry="2.8" fill="#276DC3"/>
          <path fill="#fff" d="M8 7h4c2.2 0 3.4.9 3.4 2.5 0 1-.6 1.7-1.7 2.1l2.5 4.1h-2.7l-2-3.7h-.9v3.7H8zm2.6 1.9v1.4h1c.7 0 1.1-.2 1.1-.7s-.4-.7-1.1-.7z"/>
        </>
      )
    case 'react':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#20232A"/>
          <circle cx="10" cy="10" r="1.4" fill="#61DAFB"/>
          <g stroke="#61DAFB" strokeWidth="1">
            <ellipse cx="10" cy="10" rx="6.8" ry="2.7"/>
            <ellipse cx="10" cy="10" rx="6.8" ry="2.7" transform="rotate(60 10 10)"/>
            <ellipse cx="10" cy="10" rx="6.8" ry="2.7" transform="rotate(120 10 10)"/>
          </g>
        </>
      )
    case 'ruby':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#B51F27"/>
          <path fill="#fff" d="m4 7 3-3h6l3 3-6 9-6-6z"/>
          <path fill="#F15A4A" d="m7 4 1.8 3H4zm1.8 3L13 4l3 3zm0 0L10 16 4 10zm0 0H16l-6 9z"/>
        </>
      )
    case 'rust':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#2B2B2B"/>
          <path fill="#DEA584" d="m10 2.8.7 1.3 1.4-.4.1 1.5 1.5.2-.6 1.4 1.3.8-.1.1 1.4.7-.9 1.2 1 1.1-1.2.8.6 1.3-1.4.4.3 1.5-1.5.1-.4 1.4-1.3-.5-.9 1.2-.9-1.2-1.3.5-.4-1.4-1.5-.1.3-1.5-1.4-.4.6-1.3-1.2-.8 1-1.1-.9-1.2 1.4-.7-.1-.1 1.3-.8-.6-1.4 1.5-.2.1-1.5 1.4.4z"/>
          <circle cx="10" cy="10" r="4.6" fill="#2B2B2B"/>
          <text x="10" y="13.1" textAnchor="middle" fontFamily="Georgia,serif" fontSize="8.2" fontWeight="700" fill="#DEA584">
            {CODE_MARKS.r}
          </text>
        </>
      )
    case 'scala':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#DE3423"/>
          <path fill="#fff" d="M5 4.2c3.3 1.1 6.7-.3 10-.9v3.3c-3.3.5-6.7 2-10 .8zm0 4.7c3.3 1.2 6.7-.3 10-.8v3.3c-3.3.5-6.7 1.9-10 .8zm0 4.7c3.3 1.2 6.7-.3 10-.8v3.3c-3.3.5-6.7 1.9-10 .8z"/>
        </>
      )
    case 'shell':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#303642"/>
          <path d="m5 6.5 3.5 3.5L5 13.5m5 0h5" fill="none" stroke="#7EE787" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </>
      )
    case 'solidity':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#555"/>
          <path fill="#fff" d="M7.2 3.2h5.6L10 8zm-.5.8 2.8 4.8H4zm6.6 0L16 8.8h-5.5zM4 10.3h5.5l-2.8 4.8zm6.5 0H16l-2.7 4.8zM10 11.2l2.8 4.8H7.2z"/>
        </>
      )
    case 'sql':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#336791"/>
          <ellipse cx="10" cy="5.5" rx="5.8" ry="2.1" fill="#fff"/>
          <path fill="#fff" fillOpacity=".88" d="M4.2 5.5v8.9c0 1.2 2.6 2.1 5.8 2.1s5.8-.9 5.8-2.1V5.5c0 1.2-2.6 2.1-5.8 2.1s-5.8-.9-5.8-2.1z"/>
          <path d="M4.2 9.2c0 1.2 2.6 2.1 5.8 2.1s5.8-.9 5.8-2.1M4.2 12.9c0 1.2 2.6 2.1 5.8 2.1s5.8-.9 5.8-2.1" fill="none" stroke="#336791" strokeOpacity=".7" strokeWidth=".7"/>
        </>
      )
    case 'svelte':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#FF3E00"/>
          <path d="M13.9 6.1c-.9-1.1-2.6-1.4-3.8-.7L7 7.4c-1.2.8-1.5 2.4-.7 3.6.7 1 2 1.4 3.1 1l3-1.2c.5-.2 1 .1 1.2.5.2.4 0 .9-.4 1.2l-3.1 2c-.5.3-1.1.2-1.5-.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
          <path d="M6.1 13.9c.9 1.1 2.6 1.4 3.8.7l3.1-2c1.2-.8 1.5-2.4.7-3.6-.7-1-2-1.4-3.1-1l-3 1.2c-.5.2-1-.1-1.2-.5-.2-.4 0-.9.4-1.2l3.1-2c.5-.3 1.1-.2 1.5.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
        </>
      )
    case 'swift':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#F05138"/>
          <path fill="#fff" d="M15.9 14.9c.3-3.6-1.2-6.2-3.8-8.4 1.1 1.5 1.7 2.9 1.9 4.1C10.9 8.4 8 6 5.4 3.7c1.6 2.3 3.4 4.4 5.4 6.2-1.7-1-3.5-2.2-5.6-3.7 2.3 3 4.7 5.1 7.3 6.1-2 .9-4.5.7-7.2-.8 2.2 3.2 5.6 4.1 8.3 2.4.8.4 1.6.8 2.3 1z"/>
        </>
      )
    case 'toml':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#9C4121"/>
          <text x="10" y="12.9" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="5.6" fontWeight="800" fill="#fff">
            {CODE_MARKS.toml}
          </text>
        </>
      )
    case 'typescript':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#3178C6"/>
          <text x="10" y="14" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8.4" fontWeight="800" fill="#fff">
            {CODE_MARKS.typescript}
          </text>
        </>
      )
    case 'vue':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#41B883"/>
          <path fill="#fff" d="M3.5 5h3.2l3.3 5.7L13.3 5h3.2L10 16z"/>
          <path fill="#35495E" d="M6.7 5H9l1 1.8L11 5h2.3L10 10.7z"/>
        </>
      )
    case 'wasm':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#654FF0"/>
          <path fill="#fff" d="M4 6h2l.8 5.1L8 7h2l1.2 4.1L12 6h2l-1.7 8h-2l-1.3-4-1.3 4h-2zm10.5 0H17v8h-2V8h-.5z"/>
        </>
      )
    case 'xml':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#F28C28"/>
          <path d="m7.5 6-4 4 4 4m5-8 4 4-4 4M11 5 9 15" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </>
      )
    case 'yaml':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#CB171E"/>
          <text x="10" y="12.9" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="5.6" fontWeight="800" fill="#fff">
            {CODE_MARKS.yaml}
          </text>
        </>
      )
    case 'zig':
      return (
        <>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#F7A41D"/>
          <path fill="#fff" d="M3.5 6h4L6 7.5h5L7.5 12h5L11 14h5.5l-.8-3 1-5h-4.4L14 7.5h-3.7L13 4.2H6L7.3 6z"/>
          <text x="10" y="12.2" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="4.6" fontWeight="900" fill="#F7A41D">
            {CODE_MARKS.zig}
          </text>
        </>
      )
    /* v8 ignore next -- closed-union backstop; only reached if a type is forged */
    default: return assertNever(type)
  }
}

/** Closed-union exhaustiveness guard for the embedded artwork table. */
/* v8 ignore next 3 -- only reachable when an untyped caller forges a code file type */
function assertNever(value: never): never {
  throw new Error(`unreachable code file type: ${String(value)}`)
}
