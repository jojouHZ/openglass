// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { InjectionKey } from "vue";

import type { ApiClient } from "@openglass/core";

export const ApiClientKey: InjectionKey<ApiClient> = Symbol("api-client");
