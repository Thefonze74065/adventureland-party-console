"use client";
import { dollLayerCache } from "./doll-layer-cache";
import { sanitizeDollHtml } from "./safe-doll-html";

export function dollLayers(html: string) {
  const cached = dollLayerCache.get(html);
  if (cached) return cached;
  // An inert document: unlike innerHTML on a live element, parsing here never loads images or runs handlers.
  const host = new DOMParser().parseFromString(sanitizeDollHtml(html), "text/html").body;
  const layers = Array.from(host.querySelectorAll("img")).map((img) => {
    const parent = img.parentElement as HTMLElement;
    const px = (value: string) => Number.parseFloat(value || "0") || 0;
    return {
      url: new URL(img.getAttribute("src") || "", location.href).href,
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
