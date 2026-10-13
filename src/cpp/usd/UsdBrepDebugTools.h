// SPDX-License-Identifier: Apache-2.0
// In place of usd-brep's source/BREP_SM_USD/inc/UsdBrepDebugTools.h: the debug dumps and files of the
// conversion, which smlibpy does not write.
#pragma once
#include <string>
namespace UsdBrepData { class UsdBrepArrayData; class UsdBrepArraySpans; }
inline void Dump_BrepArrayData(const UsdBrepData::UsdBrepArrayData&, bool = false) {}
inline void Dump_BrepArraySpans(const UsdBrepData::UsdBrepArrayData&, const UsdBrepData::UsdBrepArraySpans&, bool = false) {}
inline bool usdBrep_CreateOutputFiles() { return false; }
inline void usdBrep_WriteString(const std::string&) {}
inline void usdBrep_ReDirectStdOutToFile(const std::string&) {}
