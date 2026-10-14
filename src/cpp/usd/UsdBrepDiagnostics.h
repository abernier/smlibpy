// SPDX-License-Identifier: Apache-2.0
// In place of usd-brep's source/BREP_USD_DATA/inc/UsdBrepDiagnostics.h: errors are kept for the message
// of the exception that reports a failed conversion (pxr::usd_diagnostics), warnings dropped.
#pragma once
#include "pxr_lite.h"
#define USDBREP_WARN(...) ((void)0)
#define USDBREP_STATUS(...) ((void)0)
#define USDBREP_ERROR(...) ::pxr::usd_diagnose(::pxr::TfStringPrintf(__VA_ARGS__))
