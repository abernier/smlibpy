// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
// Copied from NVIDIA usd-brep (Apache-2.0, release 1.0.0, commit c9c5979), source/BREP_SM_USD/inc/SmuConvert.h.
// Changed for smlibpy: only the conversions between Breps and UsdBrepArrayData; the ones that read or
// write USD prims and stages (BrepAppend_SMLibToUsd, BrepMove_UsdToSMLib*, CreateSm*_FromUsd*) left out.

#ifndef _SMU_CONVERT_H_
#define _SMU_CONVERT_H_

#include "SmuConfig.h"

#include "SmMessages.h"
#include "SmTypes.h"

#include <cstdint>
#include <cstdio>
#include <vector>

#include "pxr_lite.h"

namespace UsdBrepData{ class UsdBrepArrayData;
                        class UsdBrepArraySpans;
                      }

class SmBrep;
class SmBrepData;
class SmPolyBrep;
class SmAttribute;
class SmContext;
template<class TYPE> class SmTArray ;

// character buffer size
#define SMU_TBLOCK_SIZE 1024

#ifdef _UNICODE
template <typename... Args>
void inline smu_sprintf(wchar_t* buff, wchar_t* format, Args... args)
{
    _sntprintf(buff, (size_t)(SMU_TBLOCK_SIZE - 1), format, args...);
    buff[SMU_TBLOCK_SIZE - 1] = L'\0';
}
#else
template <typename... Args>
void inline smu_sprintf(char* buff, const char* format, Args... args)
{
    snprintf(buff, (size_t)(SMU_TBLOCK_SIZE), format, args...);
}
#endif

void smu_WriteBuffer(const TCHAR* pBuff, const TCHAR* pBuffForFile = NULL);

namespace SMU_BrepConvert
{
    struct BrepImportResult
    {
        SmBrep* pBrep = nullptr;
        std::uint32_t iPackedBrepIndex = 0;
        SmStatus status = SM_ERR;
        bool bRemainingMembersSkipped = false;
    };

    // Append vector of SmBreps to UsdBrepArrayData
    SMU_EXPORT SmStatus BrepAppend_SMLibToUsdBrep
     (std::vector<SmBrep*>           & rSmBreps,            // i/o: target SmBreps to add to rArrays, (a SmSdfPathAttribute(UsdBrepArraypath) is added to each SmBrep_ii)
      UsdBrepData::UsdBrepArrayData & rArrays,             // i/o: UsdBrepArrayData augmented with rSmBreps data
      pxr::SdfPathVector             * pOptPaths=nullptr,   // in : optional SdfPathVector of UsdBrepArrayPaths to be added to each SmBrep_ii as an SMLib attribute
      bool bExportUVCurves = true,                          // in : when true, export Edgeuse UV trim curves (UVCurves) into rArrays for later USD writing
      bool bBoundUnboundedFaceRanges = false ) ;            // in : when true, replace unbounded face ranges with trim-curve bounds in USD only

    // move one UsdGeomGprim Brep member to SmBrep
    SMU_EXPORT SmStatus BrepMove_OneUsdBrepToSMLib
    (
        const SmContext                       & crSmContext,
        const UsdBrepData::UsdBrepArrayData  & rArrays,
        UsdBrepData::UsdBrepArraySpans       & rSpans,
        uint32_t                                iBrepIndex,
        SmBrep                               *& prSmBrep_ii,
        SmBoolean                               bHealerIsEnabled = TRUE
    );

    // move one AppendedBrepArrayData member to SmBrepData
    SMU_EXPORT SmStatus BrepMove_OneUsdBrepToSMLibData
    (
        const SmContext                       & crSmContext,
        const UsdBrepData::UsdBrepArrayData  & rArrays,
        UsdBrepData::UsdBrepArraySpans       & rSpans,
        uint32_t                                iBrepIndex,
        SmBrepData                           *& prSmBrepData_ii,
        SmTArray<SmAttribute*>                & rAttributes
    );
} // end namespace SMU_BrepConvert

#endif // no _SMU_CONVERT_H_
