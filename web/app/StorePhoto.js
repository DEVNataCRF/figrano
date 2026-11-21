'use client';
import { useEffect, useRef, useState } from 'react';

export default function StorePhoto({ src, alt = '', className }) {
  const [failedSource, setFailedSource] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);
  useEffect(() => { setLoaded(Boolean(ref.current?.complete && ref.current.naturalWidth)); }, [src]);
  if (!src || failedSource === src) return <span className={`${className || ''} media-fallback`} role={alt ? 'img' : undefined} aria-label={alt || undefined}>Foto indisponível</span>;
  return <img ref={ref} src={src} alt={alt} className={`${className || ''} photo${loaded ? ' photo--loaded' : ''}`} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailedSource(src)} />;
}
