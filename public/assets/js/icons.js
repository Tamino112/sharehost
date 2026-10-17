// Minimal stroke icon set (24×24, 1.75 stroke). Paths are drawn in the style of Lucide (ISC).
const P = {
  upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  cloud: '<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19Z"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5"/><path d="M12 12v6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-3.5v11L16 14"/>',
  music: '<circle cx="7" cy="17" r="3"/><circle cx="18" cy="15" r="3"/><path d="M10 17V5l11-2v12"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1.5"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13.5 5-3 14"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 7.75-1.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  link: '<path d="M10 14a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.2-1.2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.1a4 4 0 0 1 0 7.8"/><path d="M22 21a7 7 0 0 0-4-6.3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M13 6v2M13 11v2M13 16v2"/>',
  server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  drive: '<path d="M22 12H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/><path d="M6 16h.01M10 16h.01"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.4 3.4"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 8 10 8a9.8 9.8 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  palette: '<path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2.5a2 2 0 0 0-1.5 3.3c.6.7.2 2.7-2 2.7Z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15.5" cy="7.5" r="1"/>',
  scale: '<path d="M12 3v18M5 21h14"/><path d="m3 13 3-7 3 7a3 3 0 0 1-6 0ZM15 13l3-7 3 7a3 3 0 0 1-6 0Z"/><path d="M6 6h12"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3 7 9 6 9-6"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 13.6l-.4.4a6 6 0 0 1-7.6.7L6 22.6a2.1 2.1 0 0 1-3-3l7.9-7.9a6 6 0 0 1 .7-7.6l.4-.4 2.3 2.3a4 4 0 0 0 .4.3Z"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.1-1.3-.3-2.5-1-3.5.3-1.2.3-2.4 0-3.5 0 0-1 0-3 1.5a10.4 10.4 0 0 0-5.5 0C7.5 2 6.5 2 6.5 2c-.3 1.1-.3 2.3 0 3.5A5.4 5.4 0 0 0 5.5 9c0 3.5 3 5.5 6 5.5a4.8 4.8 0 0 0-1 3.5v4"/><path d="M9 18c-4.5 2-5-2-7-2"/>',
  hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4"/>',
  play: '<path d="m7 4 13 8-13 8Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/>',
  alert: '<path d="M12 3 2 21h20Z"/><path d="M12 10v4M12 17.5h.01"/>',
  home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  dot: '<circle cx="12" cy="12" r="1"/>',
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.dot}</svg>`;
}

export function fileIcon(mime = '', name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'svg', 'bmp'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'].includes(ext)) return 'music';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz'].includes(ext)) return 'archive';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'odt', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].includes(ext)) return 'doc';
  if (['js', 'ts', 'py', 'json', 'html', 'css', 'go', 'rs', 'java', 'c', 'cpp', 'sh', 'yml', 'yaml', 'xml'].includes(ext)) return 'code';
  return 'file';
}
