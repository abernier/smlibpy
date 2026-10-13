// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
// Copied from NVIDIA usd-brep (Apache-2.0, release 1.0.0, commit c9c5979), source/BREP_SM_USD/src/SmuAttribute.cpp.
// Changed for smlibpy: only SmSdfPathAttribute::IsKindOf, and a Dump that prints nothing.

#include "SmSmlibAll.h"
#include "SmuAttribute.h"

SMU_EXPORT void SmSdfPathAttribute::Dump(void) const {}

SMU_EXPORT SmBoolean SmSdfPathAttribute::IsKindOf( SM_TYPE t ) const
{
  return ((SmSdfPathAttribute_TYPE == t) ? TRUE : SmAttribute::IsKindOf( (t) ));
}
