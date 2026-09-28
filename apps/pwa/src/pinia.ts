// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createPinia } from "pinia";

// Module-level instance so router guards can use stores before mount.
export const pinia = createPinia();
