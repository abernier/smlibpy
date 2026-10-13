// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
// Copied from NVIDIA usd-brep (Apache-2.0, release 1.0.0, commit c9c5979), source/BREP_SM_USD/inc/SmuAttribute.h.
// Changed for smlibpy: only SmSdfPathAttribute (the material and BrepArray paths the conversion keeps on
// Breps and faces), without the methods that write USD prim specs; SmUsdXformAttribute left out.

#ifndef _SMU_ATTRIBUTE_H_
#define _SMU_ATTRIBUTE_H_

#include "SmuConfig.h"
#include "pxr_lite.h"

#include "SmAttribute.h"

#define SmSdfPathAttribute_TYPE  (SmFirstUserAttribute_TYPE + 1)
#define SmUsdXformAttribute_TYPE (SmFirstUserAttribute_TYPE + 2)

// Following are used by USD to store metadata
#define SM_AI_MATERIAL_BINDING   (SM_AI_USER_1 + 1)  // Material binding path used by USD
#define SM_AI_BREP_ARRAY         (SM_AI_USER_1 + 2)  // USD path to associated UsdSolidBrepAPI instance
#define SM_AI_XFORM_OP           (SM_AI_USER_1 + 3)  // USD Xform ops

class SmSdfPathAttribute : public SmAttribute
{
protected:
 pxr::SdfPathVector m_sMaterialPaths ;

public:
  SMU_EXPORT SmSdfPathAttribute( ULONG                      lAttributeId,
                                 SmAttributeBehaviorType    eBehavior,
                                 const pxr::SdfPathVector & rMaterialPaths)
             : SmAttribute(lAttributeId, eBehavior)
             { m_sMaterialPaths = rMaterialPaths ; }

  SMU_EXPORT SmSdfPathAttribute( const SmSdfPathAttribute & crOriginal)
             : SmAttribute(crOriginal.m_lAttributeID, crOriginal.m_eBehavior)
             { m_sMaterialPaths = crOriginal.m_sMaterialPaths ; }

  SMU_EXPORT virtual ~SmSdfPathAttribute() { }

  SMU_EXPORT virtual SmAttribute * MakeCopy(const SmContext & crContext) const
  {
    return( new (crContext) SmSdfPathAttribute( m_lAttributeID, m_eBehavior, m_sMaterialPaths) ) ;
  }

  SMU_EXPORT pxr::SdfPathVector * GetMaterialPaths()                                    { return &m_sMaterialPaths ; }
  SMU_EXPORT void                 SetMaterialPaths(pxr::SdfPathVector & rMaterialPaths) { m_sMaterialPaths = rMaterialPaths; }

  SM_COMMON_FOR_EXPORT(SmSdfPathAttribute, SmAttribute, SmSdfPathAttribute_TYPE, SMU_EXPORT);

}; //end class SmSdfPathAttribute

#endif // no _SMU_ATTRIBUTE_H_
