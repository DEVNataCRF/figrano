'use client';
import { useState } from 'react';

export default function StorePhoto({ src, alt = '', className }) {
  const [failedSource, setFailedSource] = useState(null);
  if (!src || failedSource === src) return <span className={`${className || ''} media-fallback`} role={alt ? 'img' : undefined} aria-label={alt || undefined}>Foto indisponível</span>;
  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setFailedSource(src)} />;
}
