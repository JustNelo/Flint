import type { LucideIcon } from "lucide-react";
import { Zap, ArrowRightLeft, Scaling, Crop, Stamp, Sparkles, ShieldOff } from "lucide-react";
import type { TabId } from "../types";

export interface ChainTarget {
  id: TabId;
  labelKey: string;
  icon: LucideIcon;
  /** Accepted input extensions (mirrors TAB_EXTENSIONS for these image tools). */
  accept: string[];
}

const IMG = ["png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp"];

export const CHAIN_TARGETS: ChainTarget[] = [
  { id: "compress", labelKey: "tab.compress", icon: Zap, accept: [...IMG, "ico"] },
  { id: "convert", labelKey: "tab.convert", icon: ArrowRightLeft, accept: [...IMG, "ico", "gif"] },
  { id: "resize", labelKey: "tab.resize", icon: Scaling, accept: [...IMG, "ico", "gif"] },
  { id: "crop", labelKey: "tab.crop", icon: Crop, accept: IMG },
  { id: "watermark", labelKey: "tab.watermark", icon: Stamp, accept: IMG },
  { id: "optimize", labelKey: "tab.optimize", icon: Sparkles, accept: ["png", "jpg", "jpeg"] },
  { id: "strip", labelKey: "tab.strip", icon: ShieldOff, accept: IMG },
];

/** Targets that can consume every produced extension, excluding the source. */
export function compatibleChainTargets(source: TabId, outputExts: string[]): ChainTarget[] {
  if (outputExts.length === 0) return [];
  return CHAIN_TARGETS.filter((t) => t.id !== source && outputExts.every((ext) => t.accept.includes(ext)));
}
