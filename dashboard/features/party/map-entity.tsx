"use client";
import { Sprite } from "./sprite";

export type MapEntity = {
  id: string;
  name: string;
  type: string;
  ctype?: string | null;
  mtype?: string | null;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  mp: number;
  max_mp: number;
  moving?: boolean;
  target?: string | null;
  sprite?: Sprite | null;
  direction?: number;
  going_x?: number;
  going_y?: number;
  dollHtml?: string | null;
  stand?: string | boolean | null;
  standSprite?: Sprite | null;
  weapons?: {hand:string;name:string;sprite:Sprite|null}[];
};
