"use client";
import { dollLayerCache } from "./doll-layer-cache";
import { sanitizeDollHtml } from './sanitize-doll-html';

export function dollLayers(html: string) {
  const cached = dollLayerCache.get(html);
  if (cached) return cached;
  const host = new DOMParser().parseFromString(sanitizeDollHtml(html), 'text/html');
  const layers = Array.from(host.querySelectorAll<HTMLImageElement>("img[src]")).map((img) => {
    const parent = img.parentElement as HTMLElement;
    const px = (value: string) => Number.parseFloat(value || "0") || 0;
    return {
      url: new URL(img.getAttribute('src') || '', document.baseURI).href,
      left: px(parent.style.left),
      bottom: px(parent.style.bottom),
      width: px(parent.style.width),
      height: px(parent.style.height),
      imageWidth: px(img.style.width),
      imageHeight: px(img.style.height),
      marginLeft: px(img.style.marginLeft),
      marginTop: px(img.style.marginTop),
    };
  });
  dollLayerCache.set(html, layers);
  if (dollLayerCache.size > 64) dollLayerCache.delete(dollLayerCache.keys().next().value!);
  return layers;
}
