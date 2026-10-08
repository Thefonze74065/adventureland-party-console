'use client';
import { memo, useMemo } from 'react';
import type { Char } from './char';
import { SpriteCrop } from './sprite-crop';
import { sanitizeDollHtml } from './sanitize-doll-html';

// Live vitals must not replace the image nodes underneath an active pointer.
export const CharacterPortrait = memo(function CharacterPortrait({
  html,
  sprite,
  skin,
  centered = false,
}: {
  html: Char['characterDollHtml'];
  sprite: Char['characterSprite'];
  skin: Char['skin'];
  centered?: boolean;
}) {
  const markup = useMemo(() => ({ __html: sanitizeDollHtml(html) }), [html]);
  return (
    <span
      aria-hidden="true"
      draggable={false}
      className="pointer-events-none absolute inset-0 select-none [&_*]:pointer-events-none [&_img]:[-webkit-user-drag:none]"
    >
      {html ? (
        <span
          className={centered ? "absolute left-1/2 top-1/2 h-[76px] w-[54px] -translate-x-1/2 -translate-y-1/2 [&_img]:max-w-none" : "absolute inset-0 grid -translate-y-2.5 place-items-center [&_img]:max-w-none"}
          dangerouslySetInnerHTML={markup}
        />
      ) : sprite ? (
        <SpriteCrop sprite={sprite} width={48} height={68} />
      ) : (
        <span className="grid h-full place-items-center text-[10px] text-emerald-100/35">
          {skin || 'Character'}
        </span>
      )}
    </span>
  );
});
