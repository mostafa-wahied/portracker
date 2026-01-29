import { useState, useEffect, memo, useRef, useCallback } from 'react';
import { Box, Server, Cpu } from 'lucide-react';
import { getIconUrls } from '@/lib/service-icons';

// Simple in-memory cache: remembers which URL index worked for each service+theme combo
const urlIndexCache = new Map();

function getCacheKey(name, isDark) {
  return `${name?.toLowerCase() || ''}:${isDark ? 'dark' : 'light'}`;
}

function ServiceIconComponent({ name, source = 'docker', className = '', size = 24 }) {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [needsInvert, setNeedsInvert] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const cacheKey = getCacheKey(name, isDark);
  const [urlIndex, setUrlIndex] = useState(() => urlIndexCache.get(cacheKey) ?? 0);
  const imgRef = useRef(null);
  
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  
  const urls = getIconUrls(name, isDark);
  const currentUrl = urls[urlIndex];
  const iconUrl = currentUrl?.url;
  const isThemeVariant = currentUrl?.isThemeVariant;
  
  useEffect(() => {
    const newCacheKey = getCacheKey(name, isDark);
    setUrlIndex(urlIndexCache.get(newCacheKey) ?? 0);
    setNeedsInvert(false);
    setIsLoaded(false);
  }, [isDark, name]);
  
  const checkBrightnessAndDecide = useCallback(() => {
    if (!imgRef.current) return;
    
    if (isThemeVariant) {
      setNeedsInvert(false);
      setIsLoaded(true);
      urlIndexCache.set(cacheKey, urlIndex);
      return;
    }
    
    try {
      const img = imgRef.current;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 24;
      canvas.height = 24;
      ctx.drawImage(img, 0, 0, 24, 24);
      const data = ctx.getImageData(0, 0, 24, 24).data;
      let totalBrightness = 0;
      let pixelCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128) {
          totalBrightness += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
          pixelCount++;
        }
      }
      const avgBrightness = pixelCount > 0 ? totalBrightness / pixelCount : 255;
      
      if (isDark && avgBrightness < 60) {
        const nextVariantIdx = urls.findIndex((u, i) => i > urlIndex && u.isThemeVariant);
        if (nextVariantIdx !== -1) {
          setUrlIndex(nextVariantIdx);
          return;
        }
        setNeedsInvert(true);
        setIsLoaded(true);
      } else if (!isDark && avgBrightness > 200) {
        const nextVariantIdx = urls.findIndex((u, i) => i > urlIndex && u.isThemeVariant);
        if (nextVariantIdx !== -1) {
          setUrlIndex(nextVariantIdx);
          return;
        }
        setNeedsInvert(true);
        setIsLoaded(true);
      } else {
        setNeedsInvert(false);
        setIsLoaded(true);
        urlIndexCache.set(cacheKey, urlIndex);
      }
    } catch {
      setNeedsInvert(false);
      setIsLoaded(true);
    }
  }, [cacheKey, isDark, isThemeVariant, urlIndex, urls]);
  
  const FallbackIcon = source === 'docker' ? Box : source === 'system' ? Cpu : Server;
  const containerClasses = `inline-flex items-center justify-center relative ${className}`;
  const iconSize = size * 0.75;

  const handleError = () => {
    if (urlIndex + 1 < urls.length) {
      setUrlIndex(urlIndex + 1);
      setNeedsInvert(false);
      setIsLoaded(false);
    } else {
      setUrlIndex(-1);
    }
  };

  if (!iconUrl || urlIndex < 0) {
    return (
      <div className={containerClasses} style={{ width: size, height: size }}>
        <FallbackIcon className="text-slate-400 dark:text-slate-500" style={{ width: iconSize, height: iconSize }} />
      </div>
    );
  }

  return (
    <div className={containerClasses} style={{ width: size, height: size }}>
      {!isLoaded && (
        <FallbackIcon className="text-slate-400 dark:text-slate-500 absolute" style={{ width: iconSize, height: iconSize }} />
      )}
      <img
        ref={imgRef}
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className="rounded object-contain"
        style={{
          opacity: isLoaded ? 1 : 0,
          ...(needsInvert ? { filter: 'invert(1) hue-rotate(180deg)' } : {})
        }}
        crossOrigin="anonymous"
        onError={handleError}
        onLoad={checkBrightnessAndDecide}
      />
    </div>
  );
}

const ServiceIcon = memo(ServiceIconComponent);

export default ServiceIcon;
