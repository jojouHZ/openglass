// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn-vue class helper: conditional classes + Tailwind conflict merge.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
